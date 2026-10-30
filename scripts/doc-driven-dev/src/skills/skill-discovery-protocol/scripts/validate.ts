#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";

import { loadAdapter } from "./lib/adapter";
import { scanSkills } from "./lib/scanner";
import { runSchemaGate } from "./lib/gates/schema_gate";
import { runStalenessGate } from "./lib/gates/staleness_gate";
import { runDeterministicGate } from "./lib/gates/deterministic_gate";
import { runBlockingGate } from "./lib/gates/blocking_gate";
import { renderJson } from "./lib/renderer";
import { resolveValidationReportPath } from "./lib/artifact_paths";

import type { AdapterConfig, FlowProfile, SkillReferenceCatalog, ScannedSkill, RawScannedSkill } from "./lib/types";

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

/**
 * Re-stamp `validated_at` on an artifact after a successful validation.
 * Writes directly (not via writeArtifact): this is a timestamp refresh,
 * not a regeneration, so it must not be swallowed by the modulo-timestamp
 * comparison. Everything else is preserved — the parsed object is
 * re-emitted through renderJson, the same canonical format `sdp profile`
 * uses. Returns true only when the file was actually rewritten; an
 * artifact without the field is left untouched (never fabricated).
 */
function refreshValidatedAt(
  filePath: string,
  data: Record<string, unknown>,
  timestamp: string,
): boolean {
  if (typeof data.validated_at !== "string" || data.validated_at === timestamp) {
    return false;
  }
  data.validated_at = timestamp;
  fs.writeFileSync(filePath, renderJson(data), "utf8");
  return true;
}

function isPathWithinProject(rootDir: string, candidatePath: string): boolean {
  const rel = path.relative(rootDir, candidatePath);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function findSdpRootDir(rootDir: string, profilePath: string): string | null {
  let current = path.dirname(profilePath);

  while (isPathWithinProject(rootDir, current)) {
    if (path.basename(current) === ".sdp") {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}

function findCatalogPath(profilePath: string, profile: Record<string, unknown>, cwd: string): string | null {
  const dir = path.dirname(profilePath);
  const sdpRoot = findSdpRootDir(cwd, profilePath);
  const candidates: string[] = [path.join(dir, "skill-reference-catalog.json")];

  if (sdpRoot && sdpRoot !== dir) {
    candidates.push(path.join(sdpRoot, "skill-reference-catalog.json"));
  }

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
    if (!isPathWithinProject(cwd, candidate)) {
      continue;
    }
    if (fs.existsSync(candidate)) {
      const data = loadJson(candidate);
      // Any defined skills field marks this as a catalog artifact — even a
      // malformed one — so the schema gate can report it instead of the
      // file being silently treated as absent.
      if (data && data.skills !== undefined) {
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
    orphan_skills: string[];
  };
  profile_validation: {
    flow_count: number;
    flow_stack_slot_count: number;
    unresolved_slots: string[];
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
      orphan_skills: [],
    };
  }

  const referencedSkills = new Set<string>();
  if (Array.isArray(profile.resolved_invocations)) {
    for (const inv of profile.resolved_invocations) {
      referencedSkills.add(inv.source_skill);
      referencedSkills.add(inv.resolved_skill);
    }
  }
  if (Array.isArray(profile.classification?.categories)) {
    for (const cat of profile.classification.categories) {
      for (const s of cat?.skills ?? []) referencedSkills.add(s);
    }
  }
  if (Array.isArray(profile.classification?.unmatched_skills)) {
    for (const s of profile.classification.unmatched_skills) referencedSkills.add(s);
  }

  const catalogSkills = Array.isArray(catalog.skills) ? catalog.skills : [];
  const orphanSkills: string[] = [];
  for (const skill of catalogSkills) {
    if (!referencedSkills.has(skill.name)) {
      orphanSkills.push(skill.name);
    }
  }

  const referenceCount = catalogSkills.reduce(
    (sum, s) => sum + (Array.isArray(s?.provides) ? s.provides.length : 0),
    0,
  );

  return {
    skill_count: catalog.skill_count,
    reference_count: referenceCount,
    capability_count: catalog.capability_count,
    orphan_skills: orphanSkills.sort(),
  };
}

function buildProfileValidation(
  profile: FlowProfile,
  adapter: AdapterConfig | null,
): ValidationReport["profile_validation"] {
  const unusedOverrideWarnings: string[] = [];

  if (adapter) {
    const overrides = adapter.invocation_resolution.overrides ?? { capabilities: {} as Record<string, never> };

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

  const resolvedInvocations = Array.isArray(profile.resolved_invocations)
    ? profile.resolved_invocations
    : [];
  const resolvedSlots = new Set(resolvedInvocations.map((inv) => inv.slot));
  const flowStackSlots = Array.isArray(profile.flow_stack?.slots)
    ? profile.flow_stack.slots
    : [];
  const unresolvedSlots = flowStackSlots
    .filter((slot) => !resolvedSlots.has(slot.slot_id) && !slot.default)
    .map((slot) => slot.slot_id)
    .sort();

  return {
    flow_count: 1,
    flow_stack_slot_count: flowStackSlots.length,
    unresolved_slots: unresolvedSlots,
    resolved_invocation_count: resolvedInvocations.length,
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
  if (!isPathWithinProject(cwd, profilePath)) {
    console.error(`Error: Profile path is outside project boundary: ${args.profile}`);
    process.exitCode = 2;
    return;
  }
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
  const catalogPath = findCatalogPath(profilePath, profileData, cwd);
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
  let currentRawSkills: RawScannedSkill[] = [];
  if (adapter) {
    currentRawSkills = scanSkills(cwd, adapter);
  }
  const currentCatalogSkills: ScannedSkill[] = Array.isArray(catalog?.skills)
    ? catalog.skills
    : [];

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
    stalenessResult = runStalenessGate(catalog, currentRawSkills, maxAgeDays);
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
    adapter?.validation?.deterministic?.compare,
  );

  // ─── Gate 4: Blocking Validations ───
  let blockingResult;
  const invocationEnabled = adapter?.validation?.invocation?.enabled ?? true;
  if (adapter && catalog && invocationEnabled) {
    blockingResult = runBlockingGate(profile, catalog, adapter, currentCatalogSkills);
  } else {
    blockingResult = { result: "skipped", checks: [] };
  }

  // ─── Build Catalog & Profile Validation sections ───
  const catalogValidation = buildCatalogValidation(profile, catalog);
  const profileValidation = buildProfileValidation(profile, adapter);

  // ─── validated_at refresh ───
  // A validation run is itself the event `validated_at` records. When
  // every gate that ran passes, re-stamp `validated_at` on the catalog
  // and the profile.
  //
  // When the ONLY failure is age-based staleness (no new/removed skills),
  // the artifacts' content is proven current by the schema and
  // deterministic gates — the stale timestamp is the sole defect, and it
  // is exactly what this run repairs. Refresh `validated_at`, then
  // re-evaluate the staleness gate so the documented regen path
  // (scan → infer → profile → validate) recovers pure-age staleness.
  // Any other failure (skill drift, schema errors, deterministic diff,
  // blocking violations) means the artifacts are NOT proven current:
  // never refresh, so drift stays detected on the next run.
  const stalenessAgeOnly =
    stalenessResult.result === "fail" &&
    stalenessResult.new_skills.length === 0 &&
    stalenessResult.removed_skills.length === 0;
  const nonStalenessFail = [
    schemaResult.result,
    deterministicResult.result,
    blockingResult.result,
  ].some((r) => r === "fail");

  const refreshedArtifacts: string[] = [];
  if (!nonStalenessFail && (stalenessResult.result !== "fail" || stalenessAgeOnly)) {
    const refreshedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    if (catalogPath && catalogData && refreshValidatedAt(catalogPath, catalogData, refreshedAt)) {
      refreshedArtifacts.push(path.basename(catalogPath));
    }
    if (refreshValidatedAt(profilePath, profileData, refreshedAt)) {
      refreshedArtifacts.push(path.basename(profilePath));
    }
    if (stalenessAgeOnly && catalog && adapter) {
      const maxAgeDays = adapter.validation?.staleness?.max_age_days ?? 30;
      stalenessResult = runStalenessGate(catalog, currentRawSkills, maxAgeDays);
    }
  }

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

  // ─── Write validation-report.json next to the selected profile ───
  const reportPath = resolveValidationReportPath(profilePath);
  if (!isPathWithinProject(cwd, reportPath)) {
    console.error(`Error: Report path "${reportPath}" is outside project boundary`);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const reportContent = renderJson(report);
  fs.writeFileSync(reportPath, reportContent, "utf8");

  // ─── Output summary ───
  console.log(`Schema:        ${schemaResult.result}`);
  console.log(`Staleness:     ${stalenessResult.result}`);
  console.log(`Deterministic: ${deterministicResult.result}`);
  console.log(`Blocking:      ${blockingResult.result}`);
  console.log(`Overall:       ${overallResult}`);
  if (refreshedArtifacts.length > 0) {
    console.log(`Refreshed validated_at: ${refreshedArtifacts.join(", ")}`);
  }
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
