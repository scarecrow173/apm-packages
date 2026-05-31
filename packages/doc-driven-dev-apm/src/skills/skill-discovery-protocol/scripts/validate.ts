#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { loadAdapter } = require("./lib/adapter.ts");
const { scanSkills } = require("./lib/scanner.ts");
const { runSchemaGate } = require("./lib/gates/schema_gate.ts");
const { runStalenessGate } = require("./lib/gates/staleness_gate.ts");
const { runDeterministicGate } = require("./lib/gates/deterministic_gate.ts");
const { runBlockingGate } = require("./lib/gates/blocking_gate.ts");
const { renderJson } = require("./lib/renderer.ts");

import type { AdapterConfig, FlowProfile, SkillReferenceCatalog, ScannedSkill } from "./lib/types";

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
  return `Usage: sdp validate --profile <json> [--adapter <yaml>] [--cwd <dir>]
       sdp validate --adapter <yaml> [--cwd <dir>]

Options:
  --profile  Path to flow-profile.json (runs all 4 gates)
  --adapter  Path to adapter YAML (required for deterministic gate; alone = adapter-only validation)
  --cwd      Working directory (default: process.cwd())

Exit codes:
  0  All gates pass
  1  One or more gates fail
  2  Input error`;
}

function loadJson(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content);
}

function findCatalogPath(profilePath: string, profile: Record<string, unknown>): string | null {
  const dir = path.dirname(profilePath);
  const candidates: string[] = [
    path.join(dir, "skill-reference-catalog.json"),
  ];

  if (profile.adapter_id) {
    candidates.push(path.join(dir, `${profile.adapter_id}-catalog.json`));
  }

  if (fs.existsSync(dir)) {
    const files: string[] = fs.readdirSync(dir);
    for (const f of files) {
      if (f.endsWith(".json") && f !== path.basename(profilePath) && f.includes("catalog")) {
        candidates.push(path.join(dir, f));
      }
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const data = loadJson(candidate);
      if (data && data.skills && data.slots) {
        return candidate;
      }
    }
  }

  return null;
}

type ValidationReport = {
  schema_version: string;
  generated_at: string;
  repository: string;
  adapter_id: string;
  schema_validation: { result: string; errors: { field: string; message: string }[] };
  staleness_validation: {
    result: string;
    basis: string;
    basis_date: string;
    max_age_days: number;
    age_days: number;
    new_skills: string[];
    removed_skills: string[];
  };
  deterministic_validation: {
    result: string;
    comparisons: { target: string; diff_found: boolean }[];
    reason?: string;
  };
  blocking_validations: {
    result: string;
    checks: { type: string; result: string; details: string[] }[];
  };
  catalog_validation: {
    skill_count: number;
    reference_count: number;
    capability_count: number;
    slot_count: number;
    orphan_skills: string[];
    unresolved_slots: string[];
  };
  profile_validation: {
    flow_count: number;
    resolved_invocation_count: number;
    unused_override_warnings: string[];
  };
  overall_result: string;
};

function buildCatalogValidation(
  profile: FlowProfile,
  catalog: SkillReferenceCatalog | null,
): ValidationReport["catalog_validation"] {
  if (!catalog) {
    return {
      skill_count: 0,
      reference_count: 0,
      capability_count: 0,
      slot_count: 0,
      orphan_skills: [],
      unresolved_slots: [],
    };
  }

  const referencedSkills = new Set<string>();
  if (profile.resolved_invocations) {
    for (const inv of profile.resolved_invocations) {
      referencedSkills.add(inv.source_skill);
      referencedSkills.add(inv.resolved_skill);
    }
  }
  if (profile.classification?.categories) {
    for (const cat of profile.classification.categories) {
      for (const s of cat.skills) referencedSkills.add(s);
    }
  }
  if (profile.classification?.unmatched_skills) {
    for (const s of profile.classification.unmatched_skills) referencedSkills.add(s);
  }

  const orphanSkills: string[] = [];
  for (const skill of catalog.skills) {
    if (!referencedSkills.has(skill.name)) {
      orphanSkills.push(skill.name);
    }
  }

  const resolvedSlots = new Set((profile.resolved_invocations || []).map((inv) => inv.slot));
  const unresolvedSlots: string[] = [];
  for (const slot of catalog.slots) {
    if (!resolvedSlots.has(slot.slot_id) && !slot.default_skill) {
      unresolvedSlots.push(slot.slot_id);
    }
  }

  const referenceCount = catalog.skills.reduce((sum, s) => sum + s.provides.length, 0);

  return {
    skill_count: catalog.skill_count,
    reference_count: referenceCount,
    capability_count: catalog.capability_count,
    slot_count: catalog.slot_count,
    orphan_skills: orphanSkills.sort(),
    unresolved_slots: unresolvedSlots.sort(),
  };
}

function buildProfileValidation(
  profile: FlowProfile,
  adapter: AdapterConfig | null,
): ValidationReport["profile_validation"] {
  const unusedOverrideWarnings: string[] = [];

  if (adapter) {
    const overrides = adapter.invocation_resolution.overrides;

    const resolvedBySlot = new Set(
      (profile.resolved_invocations || [])
        .filter((inv) => inv.resolution_method === "slot_override")
        .map((inv) => inv.slot),
    );

    if (overrides.slots) {
      for (const slotId of Object.keys(overrides.slots)) {
        if (!resolvedBySlot.has(slotId)) {
          unusedOverrideWarnings.push(`Slot override "${slotId}" was not used in any resolution`);
        }
      }
    }

    const resolvedByCap = new Set(
      (profile.resolved_invocations || [])
        .filter((inv) => inv.resolution_method === "capability_override")
        .map((inv) => inv.capability),
    );

    if (overrides.capabilities) {
      for (const cap of Object.keys(overrides.capabilities)) {
        if (!resolvedByCap.has(cap)) {
          unusedOverrideWarnings.push(`Capability override "${cap}" was not used in any resolution`);
        }
      }
    }
  }

  return {
    flow_count: 1,
    resolved_invocation_count: profile.resolved_invocations?.length ?? 0,
    unused_override_warnings: unusedOverrideWarnings,
  };
}

async function main(): Promise<void> {
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

  if (!args.profile && !args.adapter) {
    console.error("Error: --profile or --adapter is required");
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();

  // Adapter-only mode
  if (args.adapter && !args.profile) {
    const adapterPath = path.resolve(cwd, args.adapter);
    try {
      loadAdapter(adapterPath);
      console.log("Adapter validation passed.");
    } catch (e: unknown) {
      console.error(`Adapter validation failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
    return;
  }

  // Full validation mode with --profile
  const profilePath = path.resolve(cwd, args.profile!);
  if (!fs.existsSync(profilePath)) {
    console.error(`Error: Profile not found: ${args.profile}`);
    process.exitCode = 2;
    return;
  }

  let profileData: Record<string, unknown>;
  try {
    profileData = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  } catch {
    console.error(`Error: Invalid JSON in ${args.profile}`);
    process.exitCode = 2;
    return;
  }

  const profile = profileData as unknown as FlowProfile;

  // Load catalog (co-located)
  const catalogPath = findCatalogPath(profilePath, profileData);
  let catalogData: Record<string, unknown> | null = null;
  let catalog: SkillReferenceCatalog | null = null;
  if (catalogPath) {
    catalogData = loadJson(catalogPath);
    catalog = catalogData as unknown as SkillReferenceCatalog;
  }

  // Load adapter if provided
  let adapter: AdapterConfig | null = null;
  let adapterAbsPath: string | null = null;
  if (args.adapter) {
    adapterAbsPath = path.resolve(cwd, args.adapter);
    try {
      adapter = loadAdapter(adapterAbsPath);
    } catch (e: unknown) {
      console.error(`Warning: Could not load adapter: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Scan current skills (needed for staleness + blocking)
  let currentSkills: ScannedSkill[] = [];
  if (adapter) {
    currentSkills = scanSkills(cwd, adapter);
  }

  // ─── Gate 1: Schema Validation ───
  const schemaResult = runSchemaGate(
    profileData,
    catalogData,
    adapter ? (adapter as unknown as Record<string, unknown>) : null,
  );

  // ─── Gate 2: Staleness Validation ───
  let stalenessResult;
  if (catalog && adapter) {
    const maxAgeDays = adapter.validation?.staleness?.max_age_days ?? 30;
    stalenessResult = runStalenessGate(catalog, currentSkills, maxAgeDays);
  } else {
    stalenessResult = {
      result: "skipped",
      basis: "validated_at",
      basis_date: "",
      max_age_days: 30,
      age_days: 0,
      new_skills: [] as string[],
      removed_skills: [] as string[],
    };
  }

  // ─── Gate 3: Deterministic Validation ───
  const deterministicResult = runDeterministicGate(
    profilePath,
    catalogPath,
    adapterAbsPath,
    cwd,
  );

  // ─── Gate 4: Blocking Validations ───
  let blockingResult;
  const invocationEnabled = adapter?.validation?.invocation?.enabled ?? true;
  if (adapter && catalog && invocationEnabled) {
    blockingResult = runBlockingGate(profile, catalog, adapter, currentSkills);
  } else {
    blockingResult = { result: "skipped", checks: [] };
  }

  // ─── Build Catalog & Profile Validation sections ───
  const catalogValidation = buildCatalogValidation(profile, catalog);
  const profileValidation = buildProfileValidation(profile, adapter);

  // ─── Compute overall_result ───
  const gateResults = [
    schemaResult.result,
    stalenessResult.result,
    deterministicResult.result,
    blockingResult.result,
  ];
  const overallResult = gateResults.some((r) => r === "fail") ? "fail" : "pass";

  // ─── Build validation report ───
  const report: ValidationReport = {
    schema_version: "1.0",
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    repository: path.basename(cwd),
    adapter_id: (profileData.adapter_id as string) || "",
    schema_validation: schemaResult,
    staleness_validation: stalenessResult,
    deterministic_validation: deterministicResult,
    blocking_validations: blockingResult,
    catalog_validation: catalogValidation,
    profile_validation: profileValidation,
    overall_result: overallResult,
  };

  // ─── Write validation-report.json alongside profile ───
  const reportPath = path.join(path.dirname(profilePath), "validation-report.json");
  const reportContent = renderJson(report);
  fs.writeFileSync(reportPath, reportContent, "utf8");

  // ─── Output summary ───
  console.log(`Schema:        ${schemaResult.result}`);
  console.log(`Staleness:     ${stalenessResult.result}`);
  console.log(`Deterministic: ${deterministicResult.result}`);
  console.log(`Blocking:      ${blockingResult.result}`);
  console.log(`Overall:       ${overallResult}`);
  console.log(`Report: ${reportPath}`);

  if (schemaResult.errors.length > 0) {
    console.error(`\nSchema errors (${schemaResult.errors.length}):`);
    for (const err of schemaResult.errors.slice(0, 10)) {
      console.error(`  - [${err.field}] ${err.message}`);
    }
    if (schemaResult.errors.length > 10) {
      console.error(`  ... and ${schemaResult.errors.length - 10} more`);
    }
  }

  if (profileValidation.unused_override_warnings.length > 0) {
    console.error(`\nWarnings:`);
    for (const w of profileValidation.unused_override_warnings) {
      console.error(`  - ${w}`);
    }
  }

  process.exitCode = overallResult === "fail" ? 1 : 0;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 2;
});
