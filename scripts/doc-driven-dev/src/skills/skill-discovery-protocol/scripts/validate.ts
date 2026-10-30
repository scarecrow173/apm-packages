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
 * Stage a `validated_at` re-stamp on an artifact after a successful
 * validation — in memory only. The caller performs the actual file write
 * after validation-report.json is safely on disk (the refresh is
 * best-effort and must never block or fail the report write). The write
 * bypasses writeArtifact's modulo-timestamp no-op by emitting through
 * renderJson, the same canonical format `sdp profile` uses. Returns true
 * only when the object now holds a new timestamp that must be persisted;
 * an artifact without the field is left untouched (never fabricated).
 */
function stageValidatedAtRefresh(
  data: Record<string, unknown>,
  timestamp: string,
): boolean {
  if (typeof data.validated_at !== "string" || data.validated_at === timestamp) {
    return false;
  }
  data.validated_at = timestamp;
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
      if (inv == null) continue;
      referencedSkills.add(inv.source_skill);
      referencedSkills.add(inv.resolved_skill);
    }
  }
  if (Array.isArray(profile.classification?.categories)) {
    for (const cat of profile.classification.categories) {
      const catSkills = cat != null && Array.isArray(cat.skills) ? cat.skills : [];
      for (const s of catSkills) referencedSkills.add(s);
    }
  }
  if (Array.isArray(profile.classification?.unmatched_skills)) {
    for (const s of profile.classification.unmatched_skills) referencedSkills.add(s);
  }

  const catalogSkills = Array.isArray(catalog.skills) ? catalog.skills : [];
  const orphanSkills: string[] = [];
  for (const skill of catalogSkills) {
    if (skill == null) continue;
    if (!referencedSkills.has(skill.name)) {
      orphanSkills.push(skill.name);
    }
  }

  const referenceCount = catalogSkills.reduce(
    (sum, s) => sum + (Array.isArray(s?.provides) ? s.provides.length : 0),
    0,
  );

  return {
    skill_count: typeof catalog.skill_count === "number" ? catalog.skill_count : 0,
    reference_count: referenceCount,
    capability_count: typeof catalog.capability_count === "number" ? catalog.capability_count : 0,
    orphan_skills: orphanSkills.sort(),
  };
}

function buildProfileValidation(
  profile: FlowProfile,
  adapter: AdapterConfig | null,
): ValidationReport["profile_validation"] {
  const unusedOverrideWarnings: string[] = [];

  // Untrusted artifacts: truthy non-arrays like {} or "x" survive `?? []` /
  // `|| []` and crash `.filter`/`.map`, so every collection is narrowed with
  // Array.isArray and non-object elements are skipped before dereferencing.
  const resolvedInvocations = Array.isArray(profile.resolved_invocations)
    ? profile.resolved_invocations
    : [];

  if (adapter) {
    const overrides = adapter.invocation_resolution?.overrides ?? { capabilities: {} as Record<string, never> };

    const resolvedBySlot = new Set(
      resolvedInvocations
        .filter((inv) => inv?.resolution_method === "slot_override")
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
      resolvedInvocations
        .filter((inv) => inv?.resolution_method === "capability_override")
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

  const resolvedSlots = new Set(
    resolvedInvocations.filter((inv) => inv != null).map((inv) => inv.slot),
  );
  const flowStackSlots = Array.isArray(profile.flow_stack?.slots)
    ? profile.flow_stack.slots
    : [];
  const unresolvedSlots = flowStackSlots
    .filter((slot) => slot != null && !resolvedSlots.has(slot.slot_id) && !slot.default)
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

  // A JSON literal (null, "x", 5, []) parses but is not a profile object.
  // Normalize to {} so the schema gate reports the malformed artifact —
  // downstream field guards then see ordinary missing fields instead of
  // crashing on a primitive before the report can be written.
  if (profileData === null || typeof profileData !== "object" || Array.isArray(profileData)) {
    profileData = {};
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

  // ─── validated_at refresh (decision + in-memory staging) ───
  // A validation run is itself the event `validated_at` records — but
  // only a run that actually checked currency. Refresh requires
  // --adapter: without it the staleness, deterministic, and blocking
  // gates are all skipped, so a schema-only pass proves nothing about
  // freshness and must never re-stamp `validated_at`.
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
    // An unparseable basis date is corruption, not age: the refresh
    // repairs an expired timestamp, never a garbage one (which may be
    // tampering), so it stays a failure for regeneration to fix.
    !Number.isNaN(new Date(stalenessResult.basis_date).getTime()) &&
    stalenessResult.new_skills.length === 0 &&
    stalenessResult.removed_skills.length === 0;
  const nonStalenessFail = [
    schemaResult.result,
    deterministicResult.result,
    blockingResult.result,
  ].some((r) => r === "fail");
  const refreshEligible =
    adapter !== null &&
    !nonStalenessFail &&
    (stalenessResult.result !== "fail" || stalenessAgeOnly);

  // Stage the new timestamp in memory now — the staleness re-evaluation
  // and the report must observe it — but defer the file writes until
  // after validation-report.json is safely on disk (below).
  const pendingRefresh: { filePath: string; data: Record<string, unknown> }[] = [];
  if (refreshEligible) {
    const refreshedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    if (catalogPath && catalogData && stageValidatedAtRefresh(catalogData, refreshedAt)) {
      pendingRefresh.push({ filePath: catalogPath, data: catalogData });
    }
    if (stageValidatedAtRefresh(profileData, refreshedAt)) {
      pendingRefresh.push({ filePath: profilePath, data: profileData });
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
    adapter_id: typeof profileData.adapter_id === "string" ? profileData.adapter_id : "",
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

  // ─── Best-effort validated_at refresh writes ───
  // The report is safely on disk; a failed re-stamp (read-only artifact,
  // permissions, ...) warns on stderr but must never turn a passing run
  // into exit 2 or prevent the report write above.
  const refreshedArtifacts: string[] = [];
  for (const target of pendingRefresh) {
    try {
      fs.writeFileSync(target.filePath, renderJson(target.data), "utf8");
      refreshedArtifacts.push(path.basename(target.filePath));
    } catch (e: unknown) {
      console.error(
        `Warning: could not refresh validated_at on ${path.basename(target.filePath)}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

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
